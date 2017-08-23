import {Component, OnInit, ViewChild} from '@angular/core';
import {CircuitsService} from '../circuits.service';
import {ActivatedRoute, ParamMap} from "@angular/router";




@Component({
  selector: 'app-static-circuit-challanger',
  templateUrl: './static-circuit-challanger.component.html',
  styleUrls: ['./static-circuit-challanger.component.css']
})


export class StaticCircuitChallangerComponent implements OnInit {
@ViewChild('circuit') input ;
circuit: any ;
equation= '';
pile_equation = [];
lvl :string;
  constructor(private circuitService: CircuitsService
  ,private route: ActivatedRoute,
              ) { }
 private add_operator(t) {
  this.pile_equation.push(this.equation);
  this.equation += t;

  }

  ngOnInit() {
     this.circuit = new schematic.Schematic(this.input.nativeElement);
      this.circuit.allow_edits = false ;
      this.circuit.is_static =  true ;
      this.route.paramMap.subscribe((params: ParamMap) =>{
          this.lvl = params.get('id');
      });
    var comp = this;





    //this.circuit.is_question = true ;
      this.circuit.on_double_click_component = function (t) {
       comp.add_operator(t);

      };

     //const level = '[["r",[104,72,0],{"name":"rito","r":"1.5","_json_":0},["1","0"]],["v",[272,88,0],{"value":"dc(1)","_json_":1},["1","0"]],["s",[256,88,0],{"color":"cyan","offset":"0","_json_":2},["1"]],["g",[192,128,0],{"_json_":3},["0"]],["w",[104,120,192,128]],["w",[272,136,192,128]],["w",[104,72,256,88]],["w",[272,88,272,88]],["w",[256,88,272,88]],["view",0,0,2,"50","10","1G",null,"100","0.01","1000"]]';
     this.circuitService.getCircuit(this.lvl ).then(value => {
       const level = value.circuit;
      // console.log(value);
          this.circuit.update_schematic1();
           this.circuit.load_schematic(level) ;

     });

     //this.circuit.level = level ;

   // this.circuit.load_schematic();


  }


  remove_operator() {
    this.equation = this.pile_equation.pop();
  }

  calculate() {
    let operators = this.circuit.extract_vars(this.equation);// to remove v=
    this.circuit.randomize();
    let  ops:{[id:string ] : string} = {};
    for(let i of operators )
    { let x = this.circuit.get_component(i);
    console.log(x.properties.indexOf(1),x);

      ops[i] = x.val;

    }
    console.log(ops);
    /*let ops = this.fill_randome(operators);
    //let ops =this.circuit.dc_analysis();
    for( let op in ops)
    {
      let x =this.circuit.get_component(op);
      x.properties[1]= ops[op] ;
    }
    */
    let x = math.eval(this.equation,ops);
    this.circuit.dc_analysis();
    let y = this.circuit.dc_results['v3'];
    console.log(x,y);

  }
  fill_randome(operators ){
    let min = 0 ,max = 10;
    let  ops:{[id:string ] : number} = {};
    for ( let i of operators)
    {
      ops[i] =Math.random() * (max - min + 1) + min;
     }

     //let x = math.eval(this.equation,ops);
    return ops ;
  }



}
