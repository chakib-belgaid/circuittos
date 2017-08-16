import {AfterViewInit, Component, Input, OnInit, ViewChild} from '@angular/core';
//import {Schematic} from '../../circuit-sandbox/js/schematic.js';

declare var schematic: any;

@Component({
  selector: 'app-circuit',
  templateUrl: './circuit.component.html',
  styleUrls: ['./circuit.component.css']
})
export class CircuitComponent implements OnInit {
mode= 'false' ;
@ViewChild('aloha') input;
cir =  schematic  ;
x : any;
@Input() is_question= 'is_question';


  constructor() { }

  ngOnInit() {
  this.mode = 'True';
  this.input.nativeElement.setAttribute('height','460');
  this.input.nativeElement.setAttribute('width','800');
  this.x  = new this.cir.Schematic(this.input.nativeElement);
  this.x.printi();
  //this.x.is_question = true ;
   this.x.parts.push('c');
   this.x.load_custom_tools([["r",[104,72,0],{"name":"rito","r":"1.5"}]]);

   this.x.update_schematic1() ;

    function test(t) {
      console.log(t);
    }

    this.x.on_click_component = test;
  }


  get_netlist() {
  let d=   this.x.json();
  var level='[["r",[104,72,0],{"name":"rito","r":"1.5","_json_":0},["1","0"]],["v",[272,88,0],{"value":"dc(1)","_json_":1},["1","0"]],["s",[256,88,0],{"color":"cyan","offset":"0","_json_":2},["1"]],["g",[192,128,0],{"_json_":3},["0"]],["w",[104,120,192,128]],["w",[272,136,192,128]],["w",[104,72,256,88]],["w",[272,88,272,88]],["w",[256,88,272,88]],["view",0,0,2,"50","10","1G",null,"100","0.01","1000"]]';
  this.x.load_schematic();
  this.x.load_schematic(level);
  this.x.load_custom_tools([["r",[104,72,0],{"name":"rito","r":"1.5","_json_":0},["1","0"]]]);
  console.log(d);
  }

}
