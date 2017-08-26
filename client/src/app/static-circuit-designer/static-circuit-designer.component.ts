import {Component, OnInit, ViewChild} from '@angular/core';
import {CircuitsService} from "../circuits.service";
import {ActivatedRoute, ParamMap} from "@angular/router";


@Component({
  selector: 'app-static-circuit-designer',
  templateUrl: './static-circuit-designer.component.html',
  styleUrls: ['./static-circuit-designer.component.css']
})
export class StaticCircuitDesignerComponent implements OnInit {
@ViewChild('circuit') input ;
circuit: any ;
constructor(
  private circuitService : CircuitsService ,
 private route: ActivatedRoute, ) {}

  ngOnInit() {
      this.circuit = new schematic.Schematic(this.input.nativeElement);
      this.circuit.allow_edits = true ;
      this.circuit.parts= ['L','g','r','v','i','c','l','a','s','n'];
      this.circuit.is_static = true ;
      this.circuit.analyses.push('dc','ac','tran');
      this.circuit.update_schematic1();
       this.route.paramMap.subscribe((params: ParamMap) =>{
       let x =  params.get('id');
       if(x)
       {
         this.circuitService.load_staticlevel(x).then(value => {
       const level = value.circuit;
      // console.log(value);
          //his.circuit.update_schematic1();
           this.circuit.load_schematic(level) ;

     });
}
      });
      //this.circuit.extract_vars('R1*R2-R3+5i/c2');
  }

  save_circuit() {
    let schema = this.circuit.json();
    this.circuitService.save_staticlevel({circuit: JSON.stringify(schema)});

  }
}
